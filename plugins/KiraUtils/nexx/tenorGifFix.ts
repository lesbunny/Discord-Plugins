import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";

// Adapted from NexxUtils by nexpid; see THIRD_PARTY_NOTICES.md.
function parseTenorGifURL(url: unknown): string | undefined {
    if (typeof url !== "string") return;
    const segments = url.split("/");
    const hostIndex = segments.findIndex(segment => segment.endsWith(".tenor.com"));
    if (hostIndex < 0) return;
    const [host, id, file] = segments.slice(hostIndex, hostIndex + 3);
    if (!host || !id || !file) return;
    const filename = file.split(".")[0];
    if (!filename) return;
    // Preserve NexxUtils' original Tenor rendition mapping for MP4-backed GIF links.
    return `https://${host}/${id.slice(0, -2)}AC/${filename}.gif`;
}

export default function tenorGifFix(): () => void {
    const unpatches: Array<() => void> = [];
    const mediaManager = findByProps("downloadMediaAsset");
    const mediaShareActions = findByProps("useMediaShareActions");

    if (typeof mediaManager?.downloadMediaAsset === "function") {
        unpatches.push(before("downloadMediaAsset", mediaManager, (args: any[]) => {
            const parsed = parseTenorGifURL(args?.[0]);
            if (parsed) {
                args[0] = parsed;
                args[1] = 1;
            }
        }));
    }

    if (typeof mediaShareActions?.useMediaShareActions === "function") {
        unpatches.push(before("useMediaShareActions", mediaShareActions, (args: any[]) => {
            const source = args?.[0]?.source;
            const parsed = parseTenorGifURL(source?.uri);
            if (source && parsed) {
                source.sourceURI = parsed;
                delete source.videoURI;
            }
        }));
    }

    return () => {
        for (const unpatch of unpatches.splice(0).reverse()) {
            try { unpatch(); } catch {}
        }
    };
}
