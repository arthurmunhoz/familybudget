// App entry (package.json "main"). It exists for ONE reason: the background
// tasks must be defined in every JS context the OS starts, and on Android that
// includes HEADLESS ones — a location fix, a geofence crossing or a data-only
// push arriving after the process was killed boots the bundle WITHOUT rendering
// anything. `expo-router/entry` only registers the root component, and Metro
// loads route files (`src/app/_layout.tsx` included) lazily, on first render —
// so a task defined only via _layout doesn't exist in that context, and
// expo-task-manager then UNREGISTERS it. That is how an Android phone went
// silent for days while its UI still said "sharing" (2026-09-26).
//
// Keep this file to imports. The task modules define their tasks at module
// scope; importing them is the whole job. Covered by
// __tests__/whereabouts/headless.test.ts.
import 'expo-router/entry'

import './src/lib/locationTask'
import './src/lib/placesTask'
import './src/lib/backgroundNotifications'
