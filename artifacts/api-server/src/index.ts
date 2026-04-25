import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

// Fail fast in production if the captcha secret is missing — otherwise the
// Turnstile middleware silently degrades to "disabled" (intended for local
// dev) and the sticker route would have no human-verification protection.
if (process.env["NODE_ENV"] === "production" && !process.env["TURNSTILE_SECRET_KEY"]) {
  throw new Error(
    "TURNSTILE_SECRET_KEY is required in production to keep the sticker endpoint protected from automated abuse.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
