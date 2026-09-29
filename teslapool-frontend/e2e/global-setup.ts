import { resetDemo } from './helpers';

/** Every run starts from the same demo state. */
export default async function globalSetup() {
  await resetDemo();
}
