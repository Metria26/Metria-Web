import { describe, expect, it } from "vitest";
import { isHilltopVastPathAllowed } from "./config";
import { parseVastOffsetSeconds, parseVastXml, selectVastMediaFile } from "./vast";

const VAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="wrapper">
    <Wrapper>
      <VASTAdTagURI><![CDATA[https://ads.example.com/wrapper]]></VASTAdTagURI>
    </Wrapper>
  </Ad>
  <Ad id="559485">
    <InLine>
      <AdSystem>HilltopAds</AdSystem>
      <Error><![CDATA[https://ads.example.com/error?code=[ERRORCODE]]]></Error>
      <Impression><![CDATA[https://ads.example.com/impression]]></Impression>
      <Creatives>
        <Creative>
          <Linear skipoffset="00:00:15">
            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://ads.example.com/start]]></Tracking>
              <Tracking event="complete"><![CDATA[http://insecure.example.com/complete]]></Tracking>
            </TrackingEvents>
            <Duration>00:00:20</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/webm" bitrate="1213" width="1280" height="720"><![CDATA[https://cdn.example.com/ad.webm]]></MediaFile>
              <MediaFile delivery="progressive" type="video/mp4" bitrate="909" width="854" height="480"><![CDATA[https://cdn.example.com/ad480.mp4]]></MediaFile>
              <MediaFile delivery="progressive" type="video/mp4" bitrate="1710" width="1280" height="720"><![CDATA[https://cdn.example.com/ad720.mp4]]></MediaFile>
              <MediaFile delivery="progressive" type="video/mp4" bitrate="9999"><![CDATA[http://insecure.example.com/ad.mp4]]></MediaFile>
            </MediaFiles>
            <VideoClicks>
              <ClickThrough><![CDATA[https://ads.example.com/click]]></ClickThrough>
              <ClickTracking><![CDATA[https://ads.example.com/click-track]]></ClickTracking>
            </VideoClicks>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

describe("parseVastXml", () => {
  it("returns the first playable InLine ad and skips wrappers", () => {
    const ad = parseVastXml(VAST);
    expect(ad?.id).toBe("559485");
    expect(ad?.mediaFile.url).toBe("https://cdn.example.com/ad720.mp4");
    expect(ad?.mediaFiles.map((file) => file.url)).toEqual([
      "https://cdn.example.com/ad720.mp4",
      "https://cdn.example.com/ad.webm",
      "https://cdn.example.com/ad480.mp4",
    ]);
    expect(ad?.impressionUrls).toEqual(["https://ads.example.com/impression"]);
    expect(ad?.errorUrl).toBe("https://ads.example.com/error?code=[ERRORCODE]");
    expect(ad?.clickThroughUrl).toBe("https://ads.example.com/click");
    expect(ad?.clickTrackingUrls).toEqual(["https://ads.example.com/click-track"]);
    expect(ad?.skipOffsetSeconds).toBe(15);
    expect(ad?.durationSeconds).toBe(20);
  });

  it("keeps only HTTPS tracking URLs", () => {
    const ad = parseVastXml(VAST);
    expect(ad?.trackingEvents).toEqual([{ event: "start", url: "https://ads.example.com/start" }]);
  });

  it("fails closed on empty, malformed and wrapper-only payloads", () => {
    expect(parseVastXml("")).toBeNull();
    expect(parseVastXml("<VAST><Ad>")).toBeNull();
    expect(
      parseVastXml(
        '<VAST version="3.0"><Ad><Wrapper><VASTAdTagURI>https://x.test</VASTAdTagURI></Wrapper></Ad></VAST>',
      ),
    ).toBeNull();
  });

  it("fails closed when no linear creative has a playable media file", () => {
    const ad = parseVastXml(
      '<VAST version="3.0"><Ad><InLine><Creatives><Creative><Linear><MediaFiles><MediaFile type="video/mp4">http://insecure.test/ad.mp4</MediaFile></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>',
    );
    expect(ad).toBeNull();
  });
});

describe("selectVastMediaFile", () => {
  it("prefers MP4 over WebM and the highest bitrate", () => {
    expect(
      selectVastMediaFile([
        { url: "https://cdn.test/ad.webm", type: "video/webm", bitrate: 2000 },
        { url: "https://cdn.test/ad.mp4", type: "video/mp4", bitrate: 500 },
        { url: "https://cdn.test/ad-hd.mp4", type: "video/mp4", bitrate: 1500 },
      ])?.url,
    ).toBe("https://cdn.test/ad-hd.mp4");
  });

  it("falls back to WebM and then to any progressive file", () => {
    expect(
      selectVastMediaFile([{ url: "https://cdn.test/ad.webm", type: "video/webm", bitrate: 1 }])
        ?.url,
    ).toBe("https://cdn.test/ad.webm");
    expect(
      selectVastMediaFile([{ url: "https://cdn.test/ad.mp3", type: "audio/mpeg", bitrate: 1 }])
        ?.url,
    ).toBe("https://cdn.test/ad.mp3");
    expect(selectVastMediaFile([])).toBeNull();
  });
});

describe("parseVastOffsetSeconds", () => {
  it("parses time offsets and rejects percentages or invalid values", () => {
    expect(parseVastOffsetSeconds("00:00:15")).toBe(15);
    expect(parseVastOffsetSeconds("00:01:02")).toBe(62);
    expect(parseVastOffsetSeconds("01:02:03")).toBe(3723);
    expect(parseVastOffsetSeconds("0:30")).toBe(30);
    expect(parseVastOffsetSeconds("15%")).toBeNull();
    expect(parseVastOffsetSeconds("00:00:61")).toBeNull();
    expect(parseVastOffsetSeconds("nope")).toBeNull();
    expect(parseVastOffsetSeconds(null)).toBeNull();
  });
});

describe("isHilltopVastPathAllowed", () => {
  it("allows the public landing/legal pages and the authenticated shell", () => {
    for (const path of [
      "/",
      "/privacy",
      "/terms",
      "/about",
      "/contact",
      "/app",
      "/app/marks",
      "/app/bookings",
      "/app/offerings/x/marksheet",
    ]) {
      expect(isHilltopVastPathAllowed(path), path).toBe(true);
    }
  });

  it("keeps auth, admin and unknown routes ad-free", () => {
    for (const path of ["/auth/sign-in", "/admin/ads", "/does-not-exist"]) {
      expect(isHilltopVastPathAllowed(path), path).toBe(false);
    }
  });
});
