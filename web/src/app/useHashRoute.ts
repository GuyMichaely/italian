import { useCallback, useEffect, useState } from "react";

export const routes = ["study", "words", "grammar", "settings"] as const;
export type Route = typeof routes[number];

function readRoute(): Route {
  const value = window.location.hash.replace(/^#\/?/, "").split(/[/?]/, 1)[0];
  return routes.includes(value as Route) ? value as Route : "study";
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    function handleChange() {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    }
    window.addEventListener("hashchange", handleChange);
    return () => window.removeEventListener("hashchange", handleChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`;
  }, []);

  return [route, navigate] as const;
}
