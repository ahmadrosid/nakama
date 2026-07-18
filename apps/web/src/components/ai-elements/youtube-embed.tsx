import { youtubeEmbedSrc } from "@/lib/youtube-url";

type YoutubeEmbedProps = {
  videoId: string;
  title?: string;
};

export function YoutubeEmbed({ videoId, title = "YouTube video" }: YoutubeEmbedProps) {
  return (
    <span
      className="relative my-3 block aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-border bg-muted"
      data-streamdown="youtube-embed"
    >
      <iframe
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="absolute inset-0 size-full border-0"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        src={youtubeEmbedSrc(videoId)}
        title={title}
      />
    </span>
  );
}
