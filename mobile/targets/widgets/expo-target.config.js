/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'OneRoofWidgets',
  displayName: 'One Roof',
  colors: {
    // Warm Hearth clay accent (light / dark).
    $accent: { color: '#C2603F', darkColor: '#E4855F' },
  },
  entitlements: {
    'com.apple.security.application-groups': ['group.com.oneroof.app'],
  },
}
