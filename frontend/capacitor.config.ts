import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.travel.agent.app',
  appName: '旅行规划智能体',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  }
};

export default config;
