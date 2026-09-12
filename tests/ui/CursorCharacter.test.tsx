// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationBubble } from '../../src/ui/ConversationBubble.js';
import { CursorCharacter } from '../../src/ui/CursorCharacter.js';
import { VoiceControl } from '../../src/ui/VoiceControl.js';

describe('cursor conversation UI', () => {
  it('renders the character state beside the native pointer and respects reduced motion', () => {
    render(
      <CursorCharacter
        state="listening"
        pointer={{ x: 100, y: 200 }}
        reducedMotion
      />,
    );

    const character = screen.getByRole('status');
    expect(character).toHaveAttribute('data-state', 'listening');
    expect(character).toHaveAttribute('data-reduced-motion', 'true');
    expect(character).toHaveStyle({ left: '118px', top: '218px' });
    expect(character).toHaveTextContent('Listening');
  });

  it('clamps a response bubble inside the work area and keeps clarifications visible', () => {
    const onDismiss = vi.fn();
    render(
      <ConversationBubble
        state="clarifying"
        text="Which purchase do you mean?"
        anchor={{ x: 980, y: 780 }}
        size={{ width: 280, height: 120 }}
        workArea={{ x: 0, y: 0, width: 1_024, height: 768 }}
        onDismiss={onDismiss}
      />,
    );

    const bubble = screen.getByRole('dialog');
    expect(bubble).toHaveAttribute('data-state', 'clarifying');
    expect(bubble).toHaveStyle({ left: '732px', top: '636px' });
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('lets the user hold the talk control and mute playback', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const onMute = vi.fn();
    render(
      <VoiceControl
        listening={false}
        muted={false}
        onStart={onStart}
        onStop={onStop}
        onMute={onMute}
      />,
    );

    const talk = screen.getByRole('button', { name: /hold to talk/i });
    fireEvent.pointerDown(talk);
    fireEvent.pointerUp(talk);
    fireEvent.keyDown(talk, { key: 'Enter' });
    fireEvent.keyUp(talk, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /mute/i }));

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStop).toHaveBeenCalledTimes(2);
    expect(onMute).toHaveBeenCalledOnce();
  });

  it('dismisses passive responses after eight seconds but not while pinned', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ConversationBubble
        state="speaking"
        text="Your projected minimum is negative."
        anchor={{ x: 100, y: 100 }}
        size={{ width: 280, height: 120 }}
        workArea={{ x: 0, y: 0, width: 1_024, height: 768 }}
        onDismiss={onDismiss}
      />,
    );
    vi.advanceTimersByTime(7_999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();

    onDismiss.mockClear();
    rerender(
      <ConversationBubble
        state="speaking"
        text="Your projected minimum is negative."
        anchor={{ x: 100, y: 100 }}
        size={{ width: 280, height: 120 }}
        workArea={{ x: 0, y: 0, width: 1_024, height: 768 }}
        pinned
        onDismiss={onDismiss}
      />,
    );
    vi.advanceTimersByTime(8_000);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
