/**
 * 应用配置文件
 * 统一管理应用名称和其他全局配置
 */

import packageJson from '../package.json';

export const APP_CONFIG = {
  /** 应用名称 */
  name: 'Orbit',
  
  /** 应用名称首字母（用于 Logo） */
  nameInitial: 'O',
  
  /** 应用描述 */
  description: '以对话为入口的个人事务中心',
  
  /** 版本号 */
  version: packageJson.version,
};

export default APP_CONFIG;
