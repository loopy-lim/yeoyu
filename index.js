/**
 * @format
 */

import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import App from './App';
import YeoyuWindow from './src/YeoyuWindow';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
// Secondary OS windows (tablet free-form): compact single-tab hosts.
AppRegistry.registerComponent('YeoyuWindow', () => YeoyuWindow);
