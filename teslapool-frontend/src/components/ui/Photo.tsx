'use client';

import clsx from 'clsx';
import Image from 'next/image';
import { useState } from 'react';

/**
 * Remote photo with a branded fallback: if the image host is unreachable the frame keeps its
 * size and shows a mint wash with the caption instead of a broken-image icon.
 */
export function Photo({
  src,
  alt,
  className,
  imgClassName,
  sizes = '(min-width: 1024px) 33vw, 100vw',
  priority = false,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  sizes?: string;
  priority?: boolean;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={clsx('relative overflow-hidden bg-mint', className)}>
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs font-medium text-dark/60" role="img" aria-label={alt}>
          {alt}
        </div>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          unoptimized
          referrerPolicy="no-referrer"
          className={clsx('object-cover', imgClassName)}
          style={style}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
