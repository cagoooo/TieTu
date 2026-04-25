import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: string | HTMLElement,
        options: TurnstileRenderOptions,
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string | undefined;
    };
  }
}

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: (errorCode?: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
  appearance?: "always" | "execute" | "interaction-only";
  language?: string;
  retry?: "auto" | "never";
  action?: string;
}

export interface TurnstileWidgetHandle {
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  theme?: "light" | "dark" | "auto";
  language?: string;
}

const SCRIPT_READY_INTERVAL_MS = 100;
const SCRIPT_READY_TIMEOUT_MS = 10_000;

function whenTurnstileReady(): Promise<NonNullable<Window["turnstile"]>> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const start = Date.now();
    const handle = window.setInterval(() => {
      if (window.turnstile) {
        window.clearInterval(handle);
        resolve(window.turnstile);
        return;
      }
      if (Date.now() - start > SCRIPT_READY_TIMEOUT_MS) {
        window.clearInterval(handle);
        reject(new Error("Turnstile script failed to load."));
      }
    }, SCRIPT_READY_INTERVAL_MS);
  });
}

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget(
    { siteKey, onVerify, onError, onExpire, theme = "auto", language = "zh-tw" },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        reset() {
          if (widgetIdRef.current && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch (err) {
              console.warn("Failed to reset Turnstile widget", err);
            }
          }
        },
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;
      let createdWidgetId: string | null = null;

      whenTurnstileReady()
        .then((turnstile) => {
          if (cancelled || !containerRef.current) return;
          createdWidgetId = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme,
            language,
            retry: "auto",
            callback: (token) => {
              onVerify(token);
            },
            "error-callback": () => {
              onError?.();
            },
            "expired-callback": () => {
              onExpire?.();
            },
            "timeout-callback": () => {
              onExpire?.();
            },
          });
          widgetIdRef.current = createdWidgetId;
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("Turnstile failed to load", err);
            onError?.();
          }
        });

      return () => {
        cancelled = true;
        const id = createdWidgetId ?? widgetIdRef.current;
        if (id && window.turnstile) {
          try {
            window.turnstile.remove(id);
          } catch (err) {
            console.warn("Failed to remove Turnstile widget", err);
          }
        }
        widgetIdRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteKey]);

    return <div ref={containerRef} className="flex justify-center" />;
  },
);
