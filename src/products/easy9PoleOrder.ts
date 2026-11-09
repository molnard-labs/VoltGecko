// Manufacturer-verified Easy9 Pro residual-current devices with neutral on the left.
// Keep this list shared between new product defaults and legacy drawing positions.
const twoPole = new Set([
  'EZ9R49225','EZ9R49240','EZ9R49263',
  'EZ9D55606','EZ9D55610','EZ9D55613','EZ9D55616','EZ9D55620','EZ9D55625'
]);
const fourPole = new Set([
  'EZ9R49425','EZ9R49440','EZ9R49463','EZ9R89463',
  'EZ9D55710','EZ9D55713','EZ9D55716','EZ9D55720','EZ9D55725'
]);

export function easy9NeutralPoleCount(reference:string):2|4|undefined {
  return twoPole.has(reference) ? 2 : fourPole.has(reference) ? 4 : undefined;
}
