const modules = import.meta.glob('../../assets/feathers/*.png', { eager: true });

export const featherImages: Record<string, string> = {};
for (const [path, mod] of Object.entries(modules)) {
  const name = path.replace(/.*\//, '').replace('.png', '');
  featherImages[name] = (mod as { default: string }).default;
}

// Stats feather uses the Faith image
featherImages['Stats'] = featherImages['Faith'];
