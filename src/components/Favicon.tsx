import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Image, Text } from "react-native";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { favicons } from "@/favicons";

export function Favicon({
  url,
  fallback,
  size,
  radius = 4,
  persist = true,
}: {
  url: string;
  fallback: string;
  size: number;
  radius?: number;
  /** Private tabs use a local fallback outside the ordinary fetch/cache path. */
  persist?: boolean;
}) {
  const request = useMemo(() => ({ url, persist }), [url, persist]);
  const committed = useRef<typeof request | null>(null);
  const failed = useRef<typeof request | null>(null);
  const [image, setImage] = useState(() => ({
    request,
    source: persist ? favicons.peekForUrl(url) : null,
  }));
  // A new URL must never borrow the previous URL's resolved image.
  const source = persist
    ? image.request === request
      ? image.source
      : favicons.peekForUrl(url)
    : null;
  useLayoutEffect(() => {
    committed.current = request;
    return () => {
      committed.current = null;
    };
  }, [request]);
  useEffect(() => {
    let mounted = true;
    void favicons.forUrl(url, { persist }).then((icon) => {
      if (
        mounted &&
        committed.current === request &&
        failed.current !== request
      )
        setImage((current) =>
          current.request === request && current.source === icon
            ? current
            : { request, source: icon }
        );
    });
    return () => {
      mounted = false;
    };
  }, [url, request, persist]);
  if (!source) {
    if (fallback === "globe") {
      return (
        <ChromeIcon
          name="space"
          size={Math.max(12, Math.round(size * 0.92))}
          className="text-ink-muted"
        />
      );
    }
    return (
      <Text
        className="text-ink-muted font-semibold"
        style={{ fontSize: Math.round(size * 0.68) }}
      >
        {fallback}
      </Text>
    );
  }
  return (
    <Image
      key={url}
      source={{ uri: source }}
      style={{ width: size, height: size, borderRadius: radius }}
      onError={() => {
        if (committed.current !== request) return;
        failed.current = request;
        favicons.reportBroken(url);
        setImage({ request, source: null });
      }}
    />
  );
}
