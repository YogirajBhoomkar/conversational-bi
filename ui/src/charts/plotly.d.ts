// The Plotly bundle ships without types; it exposes the same API as `plotly.js`.
declare module 'plotly.js-dist-min' {
  import * as Plotly from 'plotly.js';
  export default Plotly;
}
