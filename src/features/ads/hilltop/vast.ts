/**
 * Minimal VAST 3/4 InLine parser for the HilltopAds video unit.
 *
 * The reviewed Hilltop tag returns InLine ads with progressive MP4/WebM
 * creatives. The player only needs the first playable linear creative, so
 * wrappers are intentionally not resolved (a wrapper-only response fails
 * closed: no creative, no ad) and percentage skip offsets are ignored. The
 * code is pure and DOM-only so jsdom can unit-test it.
 */

export type VastMediaFile = {
  url: string;
  type: string;
  bitrate: number | null;
};

export type VastTrackingEvent = {
  event: string;
  url: string;
};

export type VastAd = {
  id: string | null;
  impressionUrls: string[];
  errorUrl: string | null;
  mediaFile: VastMediaFile;
  clickThroughUrl: string | null;
  clickTrackingUrls: string[];
  trackingEvents: VastTrackingEvent[];
  skipOffsetSeconds: number | null;
  durationSeconds: number | null;
};

const HTTPS_URL = /^https:\/\//i;

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").trim();
}

function textsByTag(root: Element, tag: string): string[] {
  return Array.from(root.getElementsByTagName(tag))
    .map(textOf)
    .filter((value) => value.length > 0);
}

function directChild(parent: Element, name: string): Element | null {
  return (
    Array.from(parent.children).find(
      (child) => child.localName === name || child.tagName === name,
    ) ?? null
  );
}

/** VAST offsets are `HH:MM:SS(.ms)` or `MM:SS`; percentages return null. */
export function parseVastOffsetSeconds(value: string | null | undefined): number | null {
  const raw = (value ?? "").trim();
  if (!raw || raw.endsWith("%")) return null;

  const parts = raw.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;

  const seconds = numbers[numbers.length - 1] ?? 0;
  const minutes = numbers.length === 3 ? (numbers[1] ?? 0) : (numbers[0] ?? 0);
  const hours = numbers.length === 3 ? (numbers[0] ?? 0) : 0;
  if (minutes >= 60 || seconds >= 60) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function mediaFileFrom(element: Element): VastMediaFile | null {
  const url = textOf(element);
  if (!HTTPS_URL.test(url)) return null;

  const bitrate = Number(element.getAttribute("bitrate"));
  return {
    url,
    type: (element.getAttribute("type") ?? "").trim().toLowerCase(),
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
  };
}

function pickHighestBitrate(files: VastMediaFile[]): VastMediaFile | null {
  const sorted = [...files].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return sorted[0] ?? null;
}

/**
 * Prefer the highest-bitrate MP4 (universal support), then WebM, then any
 * progressive file. Non-HTTPS media is discarded by `mediaFileFrom`.
 */
export function selectVastMediaFile(files: VastMediaFile[]): VastMediaFile | null {
  const mp4 = files.filter((file) => file.type === "video/mp4" || /\.mp4(?:$|\?)/i.test(file.url));
  const webm = files.filter(
    (file) => file.type === "video/webm" || /\.webm(?:$|\?)/i.test(file.url),
  );

  return pickHighestBitrate(mp4) ?? pickHighestBitrate(webm) ?? pickHighestBitrate(files);
}

/** First playable InLine linear ad, or null when the payload fails closed. */
export function parseVastXml(xml: string): VastAd | null {
  if (!xml.trim()) return null;

  let document: Document;
  try {
    document = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
  if (document.getElementsByTagName("parsererror").length > 0) return null;

  for (const ad of Array.from(document.getElementsByTagName("Ad"))) {
    const inline = directChild(ad, "InLine");
    if (!inline) continue;

    const linear = inline.getElementsByTagName("Linear").item(0);
    if (!linear) continue;

    const mediaFile = selectVastMediaFile(
      Array.from(linear.getElementsByTagName("MediaFile"))
        .map(mediaFileFrom)
        .filter((file): file is VastMediaFile => file !== null),
    );
    if (!mediaFile) continue;

    const trackingEvents = Array.from(inline.getElementsByTagName("Tracking"))
      .map((element) => ({
        event: (element.getAttribute("event") ?? "").trim().toLowerCase(),
        url: textOf(element),
      }))
      .filter((entry) => entry.event.length > 0 && HTTPS_URL.test(entry.url));

    return {
      id: ad.getAttribute("id"),
      impressionUrls: textsByTag(inline, "Impression").filter((url) => HTTPS_URL.test(url)),
      errorUrl: textsByTag(inline, "Error").find((url) => HTTPS_URL.test(url)) ?? null,
      mediaFile,
      clickThroughUrl:
        textsByTag(inline, "ClickThrough").find((url) => HTTPS_URL.test(url)) ?? null,
      clickTrackingUrls: textsByTag(inline, "ClickTracking").filter((url) => HTTPS_URL.test(url)),
      trackingEvents,
      skipOffsetSeconds: parseVastOffsetSeconds(linear.getAttribute("skipoffset")),
      durationSeconds: parseVastOffsetSeconds(textsByTag(linear, "Duration")[0]),
    };
  }

  return null;
}
