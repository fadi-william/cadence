import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Outbound e-mail. Configure `SMTP_URL` (e.g. `smtps://user:pass@smtp.cadence.local:465`) and `MAIL_FROM`
 * (default `Cadence <no-reply@cadence.local>`). Without `SMTP_URL`, messages are written to the API log so
 * local setups still work.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('SMTP_URL');
    this.transport = url ? createTransport(url) : null;
    this.from = config.get<string>('MAIL_FROM', 'Cadence <no-reply@cadence.local>');
  }

  /** Whether `SMTP_URL` is set, i.e. messages are actually sent. */
  get configured() {
    return !!this.transport;
  }

  /**
   * Sends a plain-text message. Never throws: failures are logged.
   *
   * @returns true when the SMTP server accepted the message; false when mail is not configured (the message is
   *   logged instead) or sending failed
   */
  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transport) {
      this.logger.warn(`[mail disabled] To: ${to} | ${subject}\n${text}`);
      return false;
    }
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text });
      return true;
    } catch (e) {
      this.logger.error(`Failed to send mail to ${to}: ${(e as Error).message}`);
      return false;
    }
  }
}
