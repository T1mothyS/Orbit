import { expect, type Page } from '@playwright/test';
export async function answerConfirmation(page: Page, accept: boolean, trigger: () => Promise<unknown>, title = '放弃未保存的修改？') {
  await trigger(); const confirmation = page.getByRole('dialog', {name:title,exact:true});
  await expect(confirmation).toBeVisible();
  if (accept) await confirmation.locator('.oui-button--danger').click();
  else await confirmation.getByRole('button', {name:'取消',exact:true}).click();
  await expect(confirmation).toHaveCount(0);
}
