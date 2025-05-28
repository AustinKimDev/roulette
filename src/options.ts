class Options {
  useSkills: boolean = false;
  winningRank: number = 0;
  autoRecording: boolean = true;
  winningRange: number = 1;
  infiniteLoop: boolean = false;
  loopDelay: number = 5000; // milliseconds
}

const options = new Options();
export default options;
