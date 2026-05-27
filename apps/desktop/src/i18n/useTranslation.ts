import { useAppStore } from "@/store/app-store.js";
import { messages, type Locale } from "./messages.js";

type DotPath<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPath<T[K]>}`;
}[keyof T & string];

type TranslationKey = DotPath<typeof messages.en>;

function lookup(locale: Locale, key: TranslationKey): string {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages[locale]) as string;
}

export function useTranslation() {
  const locale = useAppStore((s) => s.locale);
  return {
    locale,
    t: (key: TranslationKey) => lookup(locale, key)
  };
}
