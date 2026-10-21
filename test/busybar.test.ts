import { beforeEach, describe, expect, it, vi } from 'vitest';

const draw = vi.fn();
const clear = vi.fn();

vi.mock('@busy-app/busy-lib', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BusyBar: class {
    DisplayDraw = draw;
    DisplayClear = clear;
  },
}));

const { APP_NAME, Display } = await import('../src/busybar.js');

const text = (id: string) => ({ id, type: 'text' as const, text: id, font: 'small' as const });

describe('Display', () => {
  beforeEach(() => {
    draw.mockReset().mockResolvedValue({ result: 'OK' });
    clear.mockReset().mockResolvedValue({ result: 'OK' });
  });

  it('draws at the configured priority and clears ids that disappeared', async () => {
    const display = new Display({ addr: 'bar', priority: 50 });
    await display.draw([text('graph'), text('border')]);
    expect(draw).toHaveBeenCalledWith({ application_name: APP_NAME, priority: 50, elements: [text('graph'), text('border')] });
    expect(clear).not.toHaveBeenCalled();

    await display.draw([text('graph')]);
    expect(clear).toHaveBeenCalledWith({ application_name: APP_NAME, element_ids: ['border'] });
  });

  it("returns 'busy' on HTTP 409 and rethrows other errors", async () => {
    const display = new Display({ addr: 'bar', priority: 50 });
    draw.mockRejectedValueOnce(Object.assign(new Error('priority'), { status: 409 }));
    await expect(display.draw([text('graph')])).resolves.toBe('busy');
    draw.mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 400 }));
    await expect(display.draw([text('graph')])).rejects.toThrow('bad');
  });

  it('clears all of its elements', async () => {
    await new Display({ addr: 'bar', priority: 50 }).clear();
    expect(clear).toHaveBeenCalledWith({ application_name: APP_NAME });
  });
});
