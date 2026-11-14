// Shared launcher: installed Chrome, isolated profile, with the Playwright defaults that block the
// on-device model (component updates, OptimizationHints, field trials) removed.
import { chromium } from 'playwright';
import path from 'node:path';

const PW_DISABLE_FEATURES =
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion';

export async function launchChrome() {
  return chromium.launchPersistentContext(path.resolve('prototype/.profiles/chrome'), {
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: [
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-field-trial-config',
      PW_DISABLE_FEATURES,
    ],
    args: ['--disable-features=Translate,MediaRouter'],
  });
}
