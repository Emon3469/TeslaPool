import { NewsFeatureArt, ReceiptArt, SeatGuaranteeArt } from '@/components/illustrations';
import { Photo } from '@/components/ui/Photo';
import { PHOTOS } from '@/content/media';
import type { NewsArt } from '@/content/news';

/** Thumbnail artwork for a news item. `large` is the square feature frame. */
export function NewsArtwork({ art, large = false }: { art: NewsArt; large?: boolean }) {
  if (art === 'feature') return <NewsFeatureArt className="h-full w-full" />;
  if (art === 'receipt') return <ReceiptArt className="h-full w-full" />;
  if (art === 'seats') return <SeatGuaranteeArt className="h-full w-full" />;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#f8f9fa] p-1.5">
      <div className="mb-1 flex items-center justify-center">
        {PHOTOS.avatars.map((src, i) => (
          <Photo
            key={src}
            src={src}
            alt=""
            sizes="40px"
            className={i === 1 ? '-ml-1 z-10 h-9 w-9 rounded-full border-2 border-white shadow-sm' : `${i ? '-ml-1' : ''} h-7 w-7 rounded-full border border-white`}
          />
        ))}
      </div>
      <span className={`text-center font-black uppercase leading-none tracking-tight text-dark ${large ? 'text-2xl' : 'text-[11px]'}`}>
        <span className={`block font-bold tracking-widest ${large ? 'text-sm' : 'text-[8px]'}`}>Pilot</span>
        Crew
      </span>
    </div>
  );
}
