import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const GA_ID = "G-1LMHGR2LVJ";
const PRODUCTION_HOST = "serviceai.mehrdadarjmand.com";

declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

let scriptLoaded = false;

function loadGtagScript() {
  if (scriptLoaded) return;
  scriptLoaded = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID, { send_page_view: false });
}

export function useGoogleAnalytics() {
  const location = useLocation();

  useEffect(() => {
    if (window.location.hostname !== PRODUCTION_HOST) return;
    loadGtagScript();
  }, []);

  useEffect(() => {
    if (window.location.hostname !== PRODUCTION_HOST) return;
    if (!window.gtag) return;

    const fullPath = location.pathname + location.search;
    window.gtag("event", "page_view", {
      page_path: fullPath,
      page_location: window.location.origin + fullPath,
    });
  }, [location.pathname, location.search]);
}
