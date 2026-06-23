declare module 'imagetracerjs' {
  interface ImageTracerOptions {
    numberofcolors?: number;
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    strokewidth?: number;
    linefilter?: boolean;
    rightangleenhance?: boolean;
    colorquantcycles?: number;
    mincolorratio?: number;
    blurradius?: number;
    blurdelta?: number;
    layering?: number;
    scale?: number;
    roundcoords?: number;
    lcpr?: number;
    qcpr?: number;
    desc?: boolean;
    viewbox?: boolean;
    svgrenderer?: 'default' | 'posterized';
    colorsampling?: 0 | 1 | 2;
    pal?: Array<{ r: number; g: number; b: number; a: number }>;
  }

  const ImageTracer: {
    imagedataToSVG(imageData: ImageData, options?: ImageTracerOptions): string;
    getsvgstring(
      tracedata: unknown,
      options?: ImageTracerOptions,
    ): string;
  };

  export = ImageTracer;
}
