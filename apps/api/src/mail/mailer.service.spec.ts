import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MailerService } from './mailer.service';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

const config = (values: Record<string, string>) =>
  ({ get: (k: string, d?: string) => values[k] ?? d }) as unknown as ConfigService;

describe('MailerService', () => {
  const sendMail = vi.fn();
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(createTransport)
      .mockReset()
      .mockReturnValue({ sendMail } as never);
    sendMail.mockReset();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('logs instead of sending when SMTP_URL is unset', async () => {
    const mailer = new MailerService(config({}));
    expect(mailer.configured).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
    await expect(mailer.send('a@cadence.local', 'Hi', 'body')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('To: a@cadence.local | Hi'));
  });

  it('sends through SMTP with the default sender', async () => {
    const mailer = new MailerService(config({ SMTP_URL: 'smtp://localhost:25' }));
    expect(createTransport).toHaveBeenCalledWith('smtp://localhost:25');
    expect(mailer.configured).toBe(true);
    await expect(mailer.send('a@cadence.local', 'Hi', 'body')).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Cadence <no-reply@cadence.local>',
      to: 'a@cadence.local',
      subject: 'Hi',
      text: 'body',
    });
  });

  it('uses MAIL_FROM and reports failures as false instead of throwing', async () => {
    sendMail.mockRejectedValue(new Error('550 rejected'));
    const mailer = new MailerService(config({ SMTP_URL: 'smtp://localhost', MAIL_FROM: 'Ops <ops@cadence.local>' }));
    await expect(mailer.send('a@cadence.local', 'Hi', 'body')).resolves.toBe(false);
    expect(sendMail.mock.calls[0][0].from).toBe('Ops <ops@cadence.local>');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('550 rejected'));
  });
});
