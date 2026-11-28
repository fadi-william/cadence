import { TestBed } from '@angular/core/testing';
import { CopyButton } from './copy-button';

describe('CopyButton', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });
  afterEach(() => vi.useRealTimers());

  const render = async (what?: string) => {
    const fixture = TestBed.createComponent(CopyButton);
    fixture.componentRef.setInput('value', 'secret-123');
    if (what) fixture.componentRef.setInput('what', what);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    return { fixture, button };
  };

  it('labels the button for assistive tech', async () => {
    expect((await render()).button.getAttribute('aria-label')).toBe('Copy value');
    expect((await render('webhook URL')).button.getAttribute('aria-label')).toBe(
      'Copy webhook URL',
    );
  });

  it('copies the value and briefly shows "Copied"', async () => {
    const { fixture, button } = await render();
    vi.useFakeTimers();
    await fixture.componentInstance.copy();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('secret-123');
    expect(button.textContent!.trim()).toBe('Copied');
    vi.advanceTimersByTime(1500);
    fixture.detectChanges();
    expect(button.textContent!.trim()).toBe('Copy');
  });

  it('copies on click', async () => {
    const { button } = await render();
    button.click();
    expect(writeText).toHaveBeenCalledWith('secret-123');
  });

  it('stays quiet when the clipboard is unavailable', async () => {
    writeText.mockRejectedValue(new Error('insecure'));
    const { fixture, button } = await render();
    await expect(fixture.componentInstance.copy()).resolves.toBeUndefined();
    fixture.detectChanges();
    expect(button.textContent!.trim()).toBe('Copy');
  });
});
