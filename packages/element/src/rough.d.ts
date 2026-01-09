declare module "roughjs/bundled/rough.esm.js" {
  const rough: {
    canvas(canvas: HTMLCanvasElement, config?: any): any;
    svg(svg: SVGSVGElement, config?: any): any;
    generator(config?: any): any;
    newSeed(): number;
  };
  export default rough;
}
