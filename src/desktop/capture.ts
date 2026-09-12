export interface DisplaySource {
  display_id: string;
}

export interface CapturePermissionState {
  canCapture: boolean;
  manualAmountEntry: boolean;
  retryRequiresUserAction: boolean;
  message?: string;
}

export function capturePermissionState(permission: 'granted' | 'denied'): CapturePermissionState {
  if (permission === 'denied') {
    return {
      canCapture: false,
      manualAmountEntry: true,
      retryRequiresUserAction: true,
      message: 'Screen capture permission is required. Grant access, then retry.',
    };
  }

  return {
    canCapture: true,
    manualAmountEntry: true,
    retryRequiresUserAction: false,
  };
}

export interface CaptureDependencies<TSource extends DisplaySource, TResult> {
  desktopCapturer: {
    getSources(options: { types: ['screen'] }): Promise<TSource[]>;
  };
  captureSource(source: TSource): Promise<TResult> | TResult;
  hideOverlays(): Promise<void> | void;
  restoreOverlays(): Promise<void> | void;
}

export async function captureSelectedDisplay<TSource extends DisplaySource, TResult>(
  displayId: string,
  dependencies: CaptureDependencies<TSource, TResult>,
): Promise<TResult> {
  await dependencies.hideOverlays();

  try {
    const sources = await dependencies.desktopCapturer.getSources({ types: ['screen'] });
    const source = sources.find((candidate) => candidate.display_id === displayId);

    if (!source) {
      throw new Error(`Selected display not found: ${displayId}`);
    }

    return await dependencies.captureSource(source);
  } finally {
    await dependencies.restoreOverlays();
  }
}