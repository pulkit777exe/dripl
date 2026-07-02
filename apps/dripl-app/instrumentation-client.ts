import * as Sentry from "@sentry/nextjs";
Sentry.init({
  dsn: "https://ba952e35b87452ee1fdbf98d1235f9ff@o4510967861870592.ingest.us.sentry.io/4511659824250880",
  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
  // Capture 100% in dev, 10% in production
  // Adjust based on your traffic volume
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Enable logs to be sent to Sentry
  enableLogs: true,
});
// This export will instrument router navigations
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;