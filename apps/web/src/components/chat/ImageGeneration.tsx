/**
 * Adapted from AIcss Image Generation (https://www.aicss.dev/components/image-generation).
 * Production use requires a valid AIcss license per https://www.aicss.dev/pricing
 */
import { cn } from "@nakama/ui/utils";
import styles from "./ImageGeneration.module.css";

export type ImageGenerationAspect = "square" | "portrait" | "landscape";

export interface ImageGenerationProps {
  aspect?: ImageGenerationAspect;
  className?: string;
  /** Generation already finished; a missing imageUrl only means the preview is still loading. */
  done?: boolean;
  /** When set (and no imageUrl), shows a failure canvas. */
  error?: string | null;
  /** When set, replaces the shimmer canvas with the generated image. */
  imageUrl?: string | null;
  prompt?: string;
  resolution?: string;
}

export function ImageGeneration({
  prompt = "a calm mountain lake at dawn",
  resolution = "1024 × 1024",
  aspect = "square",
  imageUrl = null,
  error = null,
  done = false,
  className,
}: ImageGenerationProps) {
  const canvasClass = cn(
    styles.igCanvas,
    aspect === "portrait" && styles.igCanvasPortrait,
    aspect === "landscape" && styles.igCanvasLandscape
  );

  const isFailed = !imageUrl && Boolean(error);
  const isComplete = Boolean(imageUrl) || (done && !isFailed);

  return (
    <div className={cn(styles.igWrap, className)}>
      <div
        aria-label={
          isFailed
            ? "Image generation failed"
            : isComplete
              ? "Generated image"
              : "Generating image"
        }
        className={canvasClass}
        role="img"
      >
        <ImageGenerationCanvasContent
          done={isComplete}
          error={isFailed ? error : null}
          imageUrl={imageUrl}
          prompt={prompt}
          resolution={resolution}
        />
      </div>
      <div className={styles.igMeta}>
        {isFailed ? (
          <span className={styles.igFailedLabel}>Generation failed</span>
        ) : isComplete ? (
          <span className={styles.igPrompt}>Generated image</span>
        ) : (
          <span className={cn(styles.igLabel, "ai-rainbow-text")}>
            Generating image
          </span>
        )}
        <span className={styles.igPrompt}>“{prompt}”</span>
      </div>
    </div>
  );
}

function ImageGenerationCanvasContent({
  imageUrl,
  error,
  done,
  prompt,
  resolution,
}: ImageGenerationProps) {
  if (imageUrl) {
    return <img alt={prompt} className={styles.igImage} src={imageUrl} />;
  }

  if (error) {
    return (
      <div className={styles.igFailed}>
        <span className={styles.igFailedDetail}>{error}</span>
      </div>
    );
  }

  if (done) {
    return <span aria-hidden className={styles.igDots} />;
  }

  return (
    <>
      <span aria-hidden className={styles.igDots} />
      <span aria-hidden className={styles.igGlow} />
      <span className={styles.igRes}>{resolution}</span>
    </>
  );
}
