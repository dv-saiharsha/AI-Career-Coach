import { Redirect } from 'expo-router'

/* The root just hands off. The gate in _layout decides where someone
   actually lands, based on whether there is a session. */
export default function Index() {
  return <Redirect href="/(app)/jobs" />
}
