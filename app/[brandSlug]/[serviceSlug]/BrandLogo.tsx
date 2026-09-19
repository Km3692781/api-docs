"use client";

import { useEffect, useState } from "react";
import { cropLogoTransparent } from "@/lib/crop-logo-client";

export default function BrandLogo({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [displaySrc, setDisplaySrc] = useState(src);

  useEffect(() => {
    let cancelled = false;
    setDisplaySrc(src);
    cropLogoTransparent(src).then((cropped) => {
      if (!cancelled && cropped) setDisplaySrc(cropped);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={displaySrc} alt={alt} className={className} />
  );
}
