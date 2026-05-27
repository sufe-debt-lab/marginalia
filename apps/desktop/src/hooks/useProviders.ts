import { useEffect, useState } from "react";
import type { ApiClient, Provider } from "@/api/client.js";

export function useProviders(api: ApiClient) {
  const [data, setData] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .listProviders()
      .then((items) => {
        if (active) setData(Array.isArray(items) ? items : []);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api]);

  return { data, loading };
}
