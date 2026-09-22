import { ServiceUnavailableException } from '@nestjs/common';
import { AgentController } from './agent.controller.js';

describe('AgentController browser/open', () => {
  it('reports why the browser could not start instead of a bare 500', async () => {
    const sessions = {
      openManagedBrowser: async () => {
        throw new Error('Could not start a browser on the machine running this backend (spawn ENOENT).');
      },
    };
    const controller = new AgentController({} as never, {} as never, {} as never, sessions as never);

    // A plain Error reaches the client as "Internal server error", which tells the user nothing.
    await expect(controller.openBrowser({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller.openBrowser({})).rejects.toThrow(/Could not start a browser/);
  });
});
