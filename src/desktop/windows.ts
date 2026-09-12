export interface OverlayWindowOptions {
  transparent: true;
  frame: false;
  alwaysOnTop: true;
  webPreferences: {
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
  };
}

export interface AnnotationWindow {
  setIgnoreMouseEvents(ignore: boolean): void;
  setFocusable(focusable: boolean): void;
}

export function overlayPolicy(): OverlayWindowOptions {
  return {
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

export function configureAnnotationWindow(window: AnnotationWindow): void {
  window.setIgnoreMouseEvents(true);
  window.setFocusable(false);
}