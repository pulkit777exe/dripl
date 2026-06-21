#!/bin/bash

# Google Cloud Run Deployment Script for Dripl Backend
# Usage: ./scripts/deploy-cloudrun.sh [http|ws|all]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

check_gcloud() {
  if ! command -v gcloud &> /dev/null; then
    error "gcloud CLI is not installed. Install: https://cloud.google.com/sdk/docs/install"
  fi
  if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -1 > /dev/null 2>&1; then
    error "Not authenticated. Run: gcloud auth login"
  fi
}

get_project_id() {
  gcloud config get-value project 2>/dev/null
}

deploy_http() {
  log "Deploying http-server to Cloud Run..."
  
  PROJECT_ID=$(get_project_id)
  if [ -z "$PROJECT_ID" ]; then
    error "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
  fi
  
  log "Using project: $PROJECT_ID"
  
  cd "$ROOT_DIR"
  
  # Build and push to Google Container Registry
  log "Building Docker image..."
  docker build \
    --target http-server \
    -t "gcr.io/$PROJECT_ID/dripl-http" \
    -f docker/Dockerfile.cloudrun .
  
  log "Pushing to Container Registry..."
  docker push "gcr.io/$PROJECT_ID/dripl-http"
  
  # Deploy to Cloud Run
  log "Deploying to Cloud Run..."
  gcloud run deploy dripl-http \
    --image "gcr.io/$PROJECT_ID/dripl-http" \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --port 8080 \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --set-env-vars "NODE_ENV=production,PORT=8080" \
    --update-secrets "DATABASE_URL=dripl-database-url:latest,JWT_SECRET=dripl-jwt-secret:latest,GOOGLE_CLIENT_ID=dripl-google-client-id:latest,GOOGLE_CLIENT_SECRET=dripl-google-client-secret:latest,FRONTEND_URL=dripl-frontend-url:latest"
  
  # Get the URL
  URL=$(gcloud run services describe dripl-http --region us-central1 --format="value(status.url)")
  log "http-server deployed successfully!"
  log "URL: $URL"
}

deploy_ws() {
  log "Deploying ws-server to Cloud Run..."
  
  PROJECT_ID=$(get_project_id)
  if [ -z "$PROJECT_ID" ]; then
    error "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
  fi
  
  log "Using project: $PROJECT_ID"
  
  cd "$ROOT_DIR"
  
  # Build and push
  log "Building Docker image..."
  docker build \
    --target ws-server \
    -t "gcr.io/$PROJECT_ID/dripl-ws" \
    -f docker/Dockerfile.cloudrun .
  
  log "Pushing to Container Registry..."
  docker push "gcr.io/$PROJECT_ID/dripl-ws"
  
  # Deploy to Cloud Run
  log "Deploying to Cloud Run..."
  gcloud run deploy dripl-ws \
    --image "gcr.io/$PROJECT_ID/dripl-ws" \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --port 8080 \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --use-http2 \
    --set-env-vars "NODE_ENV=production,WS_PORT=8080" \
    --update-secrets "DATABASE_URL=dripl-database-url:latest,JWT_SECRET=dripl-jwt-secret:latest,FRONTEND_URL=dripl-frontend-url:latest"
  
  URL=$(gcloud run services describe dripl-ws --region us-central1 --format="value(status.url)")
  log "ws-server deployed successfully!"
  log "URL: $URL"
}

setup_secrets() {
  log "Setting up Google Cloud Secrets..."
  
  PROJECT_ID=$(get_project_id)
  if [ -z "$PROJECT_ID" ]; then
    error "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
  fi
  
  # Enable Secret Manager API
  gcloud services enable secretmanager.googleapis.com
  
  # Create secrets (prompts for values)
  echo "Enter your DATABASE_URL:"
  read -s DB_URL
  echo "Enter your JWT_SECRET:"
  read -s JWT_SECRET
  echo "Enter your GOOGLE_CLIENT_ID:"
  read -s GOOGLE_CLIENT_ID
  echo "Enter your GOOGLE_CLIENT_SECRET:"
  read -s GOOGLE_CLIENT_SECRET
  echo "Enter your FRONTEND_URL (e.g., https://your-app.vercel.app):"
  read FRONTEND_URL
  
  # Create secrets
  echo -n "$DB_URL" | gcloud secrets create dripl-database-url --data-file=- 2>/dev/null || \
    echo -n "$DB_URL" | gcloud secrets versions add dripl-database-url --data-file=-
  
  echo -n "$JWT_SECRET" | gcloud secrets create dripl-jwt-secret --data-file=- 2>/dev/null || \
    echo -n "$JWT_SECRET" | gcloud secrets versions add dripl-jwt-secret --data-file=-
  
  echo -n "$GOOGLE_CLIENT_ID" | gcloud secrets create dripl-google-client-id --data-file=- 2>/dev/null || \
    echo -n "$GOOGLE_CLIENT_ID" | gcloud secrets versions add dripl-google-client-id --data-file=-
  
  echo -n "$GOOGLE_CLIENT_SECRET" | gcloud secrets create dripl-google-client-secret --data-file=- 2>/dev/null || \
    echo -n "$GOOGLE_CLIENT_SECRET" | gcloud secrets versions add dripl-google-client-secret --data-file=-
  
  echo -n "$FRONTEND_URL" | gcloud secrets create dripl-frontend-url --data-file=- 2>/dev/null || \
    echo -n "$FRONTEND_URL" | gcloud secrets versions add dripl-frontend-url --data-file=-
  
  log "Secrets created successfully!"
}

show_help() {
  cat << EOF
Google Cloud Run Deployment Script for Dripl Backend

Usage: $0 [command]

Commands:
  http        Deploy http-server only
  ws          Deploy ws-server only
  all         Deploy both services (default)
  secrets     Setup Google Cloud secrets
  help        Show this help message

Prerequisites:
  1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
  2. Authenticate: gcloud auth login
  3. Set project: gcloud config set project YOUR_PROJECT_ID
  4. Enable APIs: gcloud services enable run.googleapis.com containerregistry.googleapis.com secretmanager.googleapis.com
  5. Setup secrets: $0 secrets

Free Tier Limits:
  - 2M requests/month
  - 360,000 GB-seconds memory
  - 180,000 vCPU-seconds
  - Always free: 180,000 GiB-seconds memory

EOF
}

# Main
check_gcloud

case "${1:-all}" in
  http)
    deploy_http
    ;;
  ws)
    deploy_ws
    ;;
  all)
    deploy_http
    deploy_ws
    log "All services deployed!"
    ;;
  secrets)
    setup_secrets
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    error "Unknown command: $1. Use 'help' for usage."
    ;;
esac
