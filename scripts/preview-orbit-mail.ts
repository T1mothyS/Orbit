import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDailyReminderEmail } from '../server/daily-email-template.js';
import { renderWeeklyActivityEmail, type WeeklyEmailInput } from '../server/weekly-email-template.js';

const [inputFile, outputDirectory] = process.argv.slice(2);
if (!inputFile || !outputDirectory || process.argv.length !== 4) {
  throw new Error('Usage: tsx scripts/preview-orbit-mail.ts <input.json> <new-output-directory>');
}
const appUrl = 'https://orbit.example.invalid/today';
const input = JSON.parse(readFileSync(inputFile, 'utf8')) as
  | { version: 1; kind: 'weekly'; data: WeeklyEmailInput }
  | { version: 1; kind: 'daily'; data: Omit<Parameters<typeof renderDailyReminderEmail>[0], 'appUrl'> };
if (input.version !== 1 || !['weekly', 'daily'].includes(input.kind) || !input.data) {
  throw new Error('Expected a version 1 weekly or daily preview input');
}
const result = input.kind === 'weekly' ? renderWeeklyActivityEmail(input.data, appUrl)
  : renderDailyReminderEmail({ ...input.data, appUrl });
mkdirSync(outputDirectory, { mode: 0o700 });
writeFileSync(join(outputDirectory, 'subject.txt'), result.subject + '\n', { mode: 0o600, flag: 'wx' });
writeFileSync(join(outputDirectory, 'body.html'), result.html, { mode: 0o600, flag: 'wx' });
writeFileSync(join(outputDirectory, 'body.txt'), result.text, { mode: 0o600, flag: 'wx' });
