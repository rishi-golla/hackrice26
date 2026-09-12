import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactElement } from 'react';
import { Annotation, anchoredCardPosition, CursorHalo } from './Annotation';
import { ForecastCard } from './ForecastCard';
import type { ForecastView, SnapshotView } from './types';

export type AnalysisRequest = {
  purchaseCents: number;
  allowStale: boolean;
};

export type AnalysisCoordinator<TResult> = {
  invalidate(): void;
  request(request: AnalysisRequest): Promise<boolean>;
  latestGeneration(): number;
};

/** Keeps monitor → candidate → analysis results ordered without a queue. */
export function createAnalysisCoordinator<TResult>(
  analyze: (request: AnalysisRequest) => Promise<TResult>,
  publish: (result: TResult) => void,
): AnalysisCoordinator<TResult> {
  let generation = 0;
  let busy = false;

  return {
    invalidate(): void {
      generation += 1;
    },
    latestGeneration(): number {
      return generation;
    },
    async request(request: AnalysisRequest): Promise<boolean> {
      if (busy) return false;
      const requestGeneration = ++generation;
      busy = true;
      try {
        const result = await analyze(request);
        if (requestGeneration !== generation) return false;
        publish(result);
        return true;
      } finally {
        busy = false;
      }
    },
  };
}

export type AppProps = {
  snapshot: SnapshotView;
  forecast: ForecastView;
  candidateId?: string;
  cursor?: { x: number; y: number };
  workArea?: { x: number; y: number; width: number; height: number };
  annotation?: ComponentProps<typeof Annotation>;
  onAmountChange: (cents: number) => void;
  onDismiss?: () => void;
};

export function App({ snapshot, forecast, candidateId, cursor, workArea, annotation, onAmountChange, onDismiss }: AppProps): ReactElement {
  const [cardAnchor, setCardAnchor] = useState<{ key: string; x: number; y: number } | null>(null);
  const candidateKey = `${candidateId ?? 'candidate'}:${forecast.purchaseCents}:${forecast.minimumDate}`;
  const previousKey = useRef(candidateKey);

  useEffect(() => {
    if (!cursor || previousKey.current === candidateKey) return;
    previousKey.current = candidateKey;
    setCardAnchor({ key: candidateKey, x: cursor.x, y: cursor.y });
  }, [candidateKey, cursor]);

  useEffect(() => {
    if (cursor && cardAnchor === null) setCardAnchor({ key: candidateKey, x: cursor.x, y: cursor.y });
  }, [cardAnchor, candidateKey, cursor]);

  const cardPosition = cardAnchor && workArea
    ? anchoredCardPosition(cardAnchor, { width: 360, height: 520 }, workArea)
    : undefined;

  return (
    <>
      {cursor && <CursorHalo x={cursor.x} y={cursor.y} />}
      <div className="bodyguard-surface" style={cardPosition ? { left: cardPosition.x, top: cardPosition.y } : undefined}>
        <ForecastCard forecast={forecast} onAmountChange={onAmountChange} onDismiss={onDismiss} snapshot={snapshot} />
      </div>
      {annotation && <Annotation {...annotation} />}
    </>
  );
}
