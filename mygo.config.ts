import { defineConfig } from 'mygo-cli';
import pkg from './package.json';

export default defineConfig({
  name: 'Image to JPG',
  slug: 'image-to-jpg',
  identifier: 'com.livp.imageprocessor',
  version: pkg.version,
  icon: 'src/assets/icon.png',
  devUrl: 'http://localhost:5173',
  devCommand: 'npm run dev:web',
  buildCommand: 'npm run build:web',
  frontendDist: 'dist/frontend',
  bindings: 'src/ui/renderer/mygo.ts',
  out: 'dist',
  macos: {
    minimumSystemVersion: '13.5',
    infoPlist: { LSApplicationCategoryType: 'public.app-category.utilities' },
    signingIdentity: process.env.MACOS_SIGNING_IDENTITY
  },
  windows: { certificate: process.env.WINDOWS_CERTIFICATE }
});
