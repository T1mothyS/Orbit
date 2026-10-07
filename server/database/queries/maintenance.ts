import { clearConnected } from '../../connected-backup.js';
import { queryAll, run } from '../connection.js';
import { deleteDailyReportCloudData } from './report-cloud.js';
import { deleteOAuthUserData } from './oauth.js';
import { deleteUserOperationResults } from './operations.js';
import { removeSecret } from '../../orbit-credential-vault.js';

function clearOrbitProviderData(userId:string):void {
  for(const table of ['android_push_deliveries','android_push_devices','android_push_preferences'])run(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
  clearConnected(userId);
  removeSecret('chatgpt',userId);
  for(const table of ['library_experience_images','library_experience_sessions','note_item_images','note_images','orbit_attachments','orbit_message_attachments','orbit_request_steps','orbit_model_capabilities'])run(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
}

export function deleteUser(userId: string): boolean {
  try {
    clearOrbitProviderData(userId);
    for(const table of ['orbit_schedule_reminders','orbit_knowledge_events','orbit_proactive_events'])run(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
    deleteUserOperationResults(userId);
    run('DELETE FROM daily_report_tokens WHERE user_id = ?', [userId]);
    deleteDailyReportCloudData(userId);
    deleteOAuthUserData(userId);
    run('DELETE FROM library_preferences WHERE user_id = ?', [userId]);
    run('DELETE FROM library_publish_tokens WHERE user_id = ?', [userId]);
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
    run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
    run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]);
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
    run('DELETE FROM ai_schedule_messages WHERE user_id = ?', [userId]);
    run('DELETE FROM orbit_requests WHERE user_id=?',[userId]);
    run('DELETE FROM orbit_conversations WHERE user_id=?',[userId]);
    run('DELETE FROM orbit_preferences WHERE user_id=?',[userId]);
    run('DELETE FROM note_items WHERE user_id = ?', [userId]);
    const sessions = queryAll<{ id: string }>('SELECT id FROM sessions WHERE user_id = ?', [userId]);
    for (const session of sessions) {
      run('DELETE FROM messages WHERE session_id = ?', [session.id]);
    }
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    const result = run('DELETE FROM users WHERE id = ?', [userId]);
    return result.changes > 0;
  } catch (error) {
    console.error('[DB] Delete user error:', error);
    return false;
  }
}

export function clearUserData(userId: string): { schedules: number; sessions: number } {
  try {
    clearOrbitProviderData(userId);
    for(const table of ['orbit_schedule_reminders','orbit_knowledge_events','orbit_proactive_events'])run(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
    deleteUserOperationResults(userId);
    run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
    run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]);
    deleteDailyReportCloudData(userId);
    deleteOAuthUserData(userId);
    run('DELETE FROM library_preferences WHERE user_id = ?', [userId]);
    run('DELETE FROM library_publish_tokens WHERE user_id = ?', [userId]);
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
    run('DELETE FROM ai_schedule_messages WHERE user_id = ?', [userId]);
    run('DELETE FROM orbit_requests WHERE user_id=?',[userId]);
    run('DELETE FROM orbit_conversations WHERE user_id=?',[userId]);
    run('DELETE FROM orbit_preferences WHERE user_id=?',[userId]);
    run('DELETE FROM note_items WHERE user_id = ?', [userId]);
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
    const sessions = queryAll<{ id: string }>('SELECT id FROM sessions WHERE user_id = ?', [userId]);
    for (const session of sessions) run('DELETE FROM messages WHERE session_id = ?', [session.id]);
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    return { schedules: 0, sessions: sessions.length };
  } catch (error) {
    console.error('[DB] Clear user data error:', error);
    return { schedules: 0, sessions: 0 };
  }
}
