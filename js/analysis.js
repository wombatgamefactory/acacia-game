// Analysis wrapper: spawns Web Worker for batch simulations

function runAnalysis(iterations, bot1Type, bot2Type, onProgress, onComplete) {
  try {
    const worker = new Worker('js/analysis-worker.js');

    worker.onmessage = function(e) {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress(msg.completed, msg.total);
      } else if (msg.type === 'complete') {
        onComplete(msg.stats);
        worker.terminate();
      } else if (msg.type === 'error') {
        console.error('Worker error:', msg.error);
        onComplete(null);
        worker.terminate();
      }
    };

    worker.onerror = function(error) {
      console.error('Worker creation error:', error.message, error.filename, error.lineno);
      onComplete(null); // Signal failure
    };

    worker.postMessage({
      iterations,
      bot1Type,
      bot2Type,
      mctsThinkTime: 200
    });
  } catch (err) {
    console.error('Failed to create worker:', err);
    onComplete(null);
  }
}
