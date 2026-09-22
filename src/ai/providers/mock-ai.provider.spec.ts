import { MockAiProvider } from './mock-ai.provider.js';

const MOBILE_PHONES_INSTRUCTIONS = `
Go to the website.

Login to my account.

Open Mobile Phones.

Select Lahore.

Open each listing.

Extract the title, date, description, seller name, address and contact number.

For the contact number, click the "Show Phone Number" button and extract the number displayed on the page.

Add all information to CSV.
`;

const CARS_INSTRUCTIONS =
  'Go to the website, open Cars, select Islamabad, open every listing and collect title, price, model, seller and contact number.';

describe('MockAiProvider.parseInstructionsToPlan', () => {
  const provider = new MockAiProvider();

  it('parses the canonical Mobile Phones / Lahore example', async () => {
    const plan = await provider.parseInstructionsToPlan(MOBILE_PHONES_INSTRUCTIONS, 'https://example.com');

    const types = plan.steps.map((s) => s.type);
    expect(types).toEqual([
      'open_website',
      'login',
      'open_category',
      'select_location',
      'find_listings',
      'open_each_listing',
      'extract',
      'click_and_extract',
      'save_csv',
    ]);

    const openCategory = plan.steps.find((s) => s.type === 'open_category');
    expect(openCategory?.value).toBe('Mobile Phones');

    const selectLocation = plan.steps.find((s) => s.type === 'select_location');
    expect(selectLocation?.value).toBe('Lahore');

    const clickAndExtract = plan.steps.find((s) => s.type === 'click_and_extract');
    expect(clickAndExtract?.target).toBe('Show Phone Number');
    expect(clickAndExtract?.field).toBe('contact_number');

    expect(plan.fieldList.sort()).toEqual(
      ['title', 'date', 'description', 'seller_name', 'address', 'contact_number'].sort(),
    );
  });

  it('parses the comma-joined Cars / Islamabad example', async () => {
    const plan = await provider.parseInstructionsToPlan(CARS_INSTRUCTIONS, 'https://example.com');

    const types = plan.steps.map((s) => s.type);
    expect(types).toEqual([
      'open_website',
      'open_category',
      'select_location',
      'find_listings',
      'open_each_listing',
      'extract',
      'save_csv',
    ]);

    expect(plan.steps.find((s) => s.type === 'open_category')?.value).toBe('Cars');
    expect(plan.steps.find((s) => s.type === 'select_location')?.value).toBe('Islamabad');
    expect(plan.fieldList.sort()).toEqual(['title', 'price', 'model', 'seller_name', 'contact_number'].sort());
  });

  it('adds a field mentioned later via "Also collect"', async () => {
    const plan = await provider.parseInstructionsToPlan('Extract the title. Also collect price.', 'https://example.com');
    expect(plan.fieldList).toEqual(expect.arrayContaining(['title', 'price']));
  });
});

describe('MockAiProvider.groundElement', () => {
  const provider = new MockAiProvider();

  it('matches the best-scoring element by text', async () => {
    const result = await provider.groundElement({
      targetDescription: 'Mobile Phones',
      actionHint: 'click',
      elements: [
        { index: 0, role: 'link', text: 'Home' },
        { index: 1, role: 'link', text: 'Mobile Phones' },
        { index: 2, role: 'link', text: 'Cars' },
      ],
    });
    expect(result.found).toBe(true);
    expect(result.elementIndex).toBe(1);
  });

  it('reports not found when nothing matches', async () => {
    const result = await provider.groundElement({
      targetDescription: 'Show Phone Number',
      actionHint: 'click',
      elements: [
        { index: 0, role: 'link', text: 'Home' },
        { index: 1, role: 'link', text: 'About Us' },
      ],
    });
    expect(result.found).toBe(false);
  });
});
