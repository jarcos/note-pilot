// electron-builder afterPack hook: ad-hoc sign the .app on macOS.
// Without ANY signature, an unsigned app downloaded from the internet shows the
// scary "is damaged and can't be opened" on Apple Silicon. An ad-hoc signature
// (codesign -s -) turns that into the normal "unidentified developer" prompt,
// so a right-click → Open works (no Terminal needed). This is NOT notarization —
// users still see one prompt on first launch.
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • ad-hoc signing ${appName}.app`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
};
