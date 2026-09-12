// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { VerificationPrompt } from '../../src/ui/VerificationPrompt';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function bridge() { return { verificationStart: vi.fn().mockResolvedValue({ state: 'pending', requestId: 'r' }),
  verificationStatus: vi.fn().mockResolvedValue({ state: 'pending', requestId: 'r' }),
  verificationCancel: vi.fn().mockResolvedValue(undefined), verificationResume: vi.fn().mockResolvedValue(undefined) }; }
describe('verification prompt', () => {
  it('does not start automatically and prevents repeated Verify clicks while waiting', async () => {
    const api = bridge(); api.verificationStart.mockImplementation(() => new Promise(() => {}));
    render(<VerificationPrompt view={{ state: 'locked', requestId: 'r' }} bridge={api} />);
    expect(api.verificationStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify identity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opening…' }));
    expect(api.verificationStart).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Lowest|Safe to spend/)).toBeNull();
  });
  it('polls every two seconds and stops on unmount', async () => {
    vi.useFakeTimers(); const api = bridge();
    const { unmount } = render(<VerificationPrompt view={{ state: 'pending', requestId: 'r' }} bridge={api} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); }); expect(api.verificationStatus).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(api.verificationStatus).toHaveBeenCalledOnce();
    unmount(); await vi.advanceTimersByTimeAsync(10_000); expect(api.verificationStatus).toHaveBeenCalledOnce();
  });
  it('requires a separate Continue click and exposes cancellation', async () => {
    const api = bridge();
    const { rerender } = render(<VerificationPrompt view={{ state: 'approved', requestId: 'r' }} bridge={api} />);
    expect(api.verificationResume).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })));
    expect(api.verificationResume).toHaveBeenCalledWith('r');
    rerender(<VerificationPrompt view={{ state: 'pending', requestId: 'r' }} bridge={api} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
    expect(api.verificationCancel).toHaveBeenCalledWith('r');
  });
});
