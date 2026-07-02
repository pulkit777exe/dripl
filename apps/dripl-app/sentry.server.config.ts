import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://ba952e35b87452ee1fdbf98d1235f9ff@o4510967861870592.ingest.us.sentry.io/4511659824250880",
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});
