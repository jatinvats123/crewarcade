import { cn } from '@/lib/cn';
import { DpadMark, PlayA } from './marks';

/**
 * The CrewArcade logo: the D-pad "+3" icon and the wordmark "CREW▲RCADE" in the poster font, whose
 * A of ARCADE is a play triangle. Size it with font-size (e.g. text-xl).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[0.45em]', className)} role="img" aria-label="CrewArcade">
      <DpadMark className="h-[1.15em] w-auto shrink-0" />
      <span aria-hidden className="inline-flex items-baseline font-poster leading-none tracking-wide uppercase">
        Crew
        <PlayA className="mx-[0.06em] h-[0.74em] w-auto" />
        rcade
      </span>
    </span>
  );
}

/** The icon alone (footer, favicon, avatars): the D-pad "+3". */
export function LogoMark({ className }: { className?: string }) {
  return <DpadMark className={cn('h-auto', className)} />;
}
