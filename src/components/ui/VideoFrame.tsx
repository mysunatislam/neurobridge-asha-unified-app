"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { PlayIcon } from "./icons";

type VideoFrameProps = {
  /** Video file URL. Leave empty until the video is ready — a poster placeholder is shown. */
  src?: string;
  /** YouTube video id. When set, the play button opens YouTube's player inside the frame. */
  youtubeId?: string;
  /** Poster image. When omitted, a branded placeholder with the Asha avatar is shown. */
  poster?: string;
  posterAlt: string;
  label?: string;
  duration?: string;
  /** "click": poster + play button (hero demo). "ambient": muted autoplay loop (feature clips). */
  mode?: "click" | "ambient";
  className?: string;
};

export function VideoFrame({ src, youtubeId, poster, posterAlt, label, duration, mode = "click", className }: VideoFrameProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const playable = Boolean(src || youtubeId);
  const frame = cn(
    "relative aspect-video w-full overflow-hidden rounded-[28px] bg-brand-soft shadow-float ring-1 ring-line/60",
    className,
  );

  if (src && mode === "ambient")
    return (
      <div className={frame}>
        <video className="size-full object-cover" src={src} poster={poster} autoPlay muted loop playsInline>
          {posterAlt}
        </video>
      </div>
    );

  return (
    <div className={frame}>
      {youtubeId && playing ? (
        <iframe
          className="absolute inset-0 size-full"
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={label ?? posterAlt}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          // The site sends no-referrer; YouTube's player refuses to start without the page origin.
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : src && playing ? (
        <video ref={video} className="size-full object-cover" src={src} poster={poster} controls autoPlay playsInline>
          Your browser does not support embedded video.
        </video>
      ) : (
        <button
          type="button"
          className="group absolute inset-0 text-white disabled:cursor-default"
          onClick={() => setPlaying(true)}
          disabled={!playable}
          aria-label={playable ? `Play: ${label ?? posterAlt}` : posterAlt}
        >
          {poster ? (
            <Image src={poster} alt={posterAlt} fill sizes="(max-width: 768px) 100vw, 900px" className="object-cover" />
          ) : (
            <span className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#dbeafe_0%,#eff6ff_45%,#ffffff_100%)]">
              <Image
                src="/assets/assets/images/asha-avatar.png"
                alt={posterAlt}
                width={168}
                height={168}
                className="absolute top-[42%] left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full object-cover shadow-card ring-8 ring-white sm:size-40"
              />
            </span>
          )}
          {poster && <span className="absolute inset-0 bg-gradient-to-t from-heading/50 via-transparent to-transparent" />}
          {label && (
            <span className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-heading/75 py-2 pr-5 pl-2 whitespace-nowrap backdrop-blur-md transition group-enabled:group-hover:bg-heading/90 sm:bottom-8">
              <span className="grid size-10 place-items-center rounded-full bg-white text-brand">
                <PlayIcon />
              </span>
              <span className="text-left leading-tight">
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-white/80">{playable ? duration : "Video coming soon"}</span>
              </span>
            </span>
          )}
        </button>
      )}
    </div>
  );
}
