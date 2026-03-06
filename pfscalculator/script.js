document.getElementById('pfsForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const proposalTypeElement = document.querySelector('input[name="proposalType"]:checked');
    if (!proposalTypeElement) {
        const errorDiv = document.getElementById('pfsError');
        errorDiv.textContent = 'Please select who made the proposal.';
        errorDiv.style.display = 'block';
        return;
    }
    const pfsErrorDiv = document.getElementById('pfsError');
    pfsErrorDiv.style.display = 'none';
    const proposalType = proposalTypeElement.value;
    const proposalAmount = parseCurrencyInput(document.getElementById('proposalAmount').value);
    const judgmentAmount = parseCurrencyInput(document.getElementById('judgmentAmount').value);

    if (proposalAmount <= 0 || judgmentAmount <= 0) {
        const errorDiv = document.getElementById('pfsError');
        errorDiv.textContent = 'Please enter valid amounts greater than $0.';
        errorDiv.style.display = 'block';
        return;
    }

    const results = calculatePFS(proposalType, proposalAmount, judgmentAmount);
    displayResults(results);
});

function calculatePFS(proposalType, proposalAmount, judgmentAmount) {
    let threshold, difference, percentDifference, meetsThreshold;

    if (proposalType === 'plaintiff') {
        // Plaintiff: Judgment must be at least 25% MORE than proposal
        threshold = proposalAmount * 1.25;
        difference = judgmentAmount - proposalAmount;
        percentDifference = (difference / proposalAmount) * 100;
        meetsThreshold = judgmentAmount >= threshold;

        return {
            type: 'Plaintiff',
            proposalAmount: proposalAmount,
            judgmentAmount: judgmentAmount,
            threshold: threshold,
            difference: difference,
            percentDifference: percentDifference,
            meetsThreshold: meetsThreshold,
            explanation: meetsThreshold
            ? `The judgment of ${formatCurrency(judgmentAmount)} is ${percentDifference.toFixed(2)}% more than the proposal of ${formatCurrency(proposalAmount)}, which meets the required 25% threshold.`
            : `The judgment of ${formatCurrency(judgmentAmount)} must be ${formatCurrency(threshold)} or more (25% more than the proposal) to meet the threshold. The actual difference of ${percentDifference.toFixed(2)}% does not satisfy this requirement.`
        };

    } else { // defendant
        // Defendant: Judgment must be at least 25% LESS than proposal
        threshold = proposalAmount * 0.75;
        difference = proposalAmount - judgmentAmount;
        percentDifference = (difference / proposalAmount) * 100;
        meetsThreshold = judgmentAmount <= threshold;
    
        return {
            type: 'Defendant',
            proposalAmount: proposalAmount,
            judgmentAmount: judgmentAmount,
            threshold: threshold,
            difference: difference,
            percentDifference: percentDifference,
            meetsThreshold: meetsThreshold,
            explanation: meetsThreshold
            ? `The judgment of ${formatCurrency(judgmentAmount)} is ${percentDifference.toFixed(2)}% less than the proposal of ${formatCurrency(proposalAmount)}, which meets the required 25% threshold.`
            : `The judgment of ${formatCurrency(judgmentAmount)} must be ${formatCurrency(threshold)} or less (25% less than the proposal) to meet the threshold. The actual difference of ${percentDifference.toFixed(2)}% does not satisfy this requirement.`
        };
    }
}

function displayResults(results) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';

    const resultClass = results.meetsThreshold ? 'success' : 'failure';
    const resultText = results.meetsThreshold ? 'Threshold MET' : 'Threshold NOT Met';

    const percentRounded = Math.abs(results.percentDifference).toFixed(2);
    const showRoundingWarning = !results.meetsThreshold && (percentRounded === '25.00' || Math.abs(percentRounded - 25.0) < 0.01);

    var h3 = document.createElement('h3');
    h3.textContent = resultText;
    resultsDiv.appendChild(h3);

    function addLine(label, value) {
        var p = document.createElement('p');
        var strong = document.createElement('strong');
        strong.textContent = label;
        p.appendChild(strong);
        p.appendChild(document.createTextNode(' ' + value));
        resultsDiv.appendChild(p);
    }

    addLine(results.type + "'s Proposal:", formatCurrency(results.proposalAmount));
    addLine('Final Judgment:', formatCurrency(results.judgmentAmount));
    addLine('Required Threshold:', formatCurrency(results.threshold));
    addLine('Percent Difference:', percentRounded + '%');

    var explanationP = document.createElement('p');
    explanationP.textContent = results.explanation;
    resultsDiv.appendChild(explanationP);

    if (showRoundingWarning) {
        var warningP = document.createElement('p');
        warningP.className = 'rounding-warning';
        var warningStrong = document.createElement('strong');
        warningStrong.textContent = 'Note on Rounding:';
        warningP.appendChild(warningStrong);
        warningP.appendChild(document.createTextNode(' While the percentage difference rounds to 25.00%, the statute requires the judgment dollar amount to meet the threshold. Due to rounding precision, the actual judgment amount does not satisfy the "at least 25 percent" requirement specified in \u00a7 768.79.'));
        resultsDiv.appendChild(warningP);
    }

    var resultP = document.createElement('p');
    var resultStrong = document.createElement('strong');
    resultStrong.textContent = 'Result:';
    resultP.appendChild(resultStrong);
    resultP.appendChild(document.createTextNode(results.meetsThreshold
        ? ' The proposing party may be entitled to recover attorney\'s fees under \u00a7 768.79.'
        : ' The proposing party is not entitled to recover attorney\'s fees under \u00a7 768.79.'));
    resultsDiv.appendChild(resultP);

    resultsDiv.className = 'results ' + resultClass;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(amount);
}

// Reverse Calculator
document.getElementById('reverseForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const proposalTypeElement = document.querySelector('input[name="reverseProposalType"]:checked');
    if (!proposalTypeElement) {
        const errorDiv = document.getElementById('reverseError');
        errorDiv.textContent = 'Please select who is making the proposal.';
        errorDiv.style.display = 'block';
        return;
    }
    const reverseErrorDiv = document.getElementById('reverseError');
    reverseErrorDiv.style.display = 'none';
    const proposalType = proposalTypeElement.value;
    const proposalAmount = parseCurrencyInput(document.getElementById('reverseProposalAmount').value);

    if (proposalAmount <= 0) {
        const errorDiv = document.getElementById('reverseError');
        errorDiv.textContent = 'Please enter a valid proposal amount greater than $0.';
        errorDiv.style.display = 'block';
        return;
    }

    const results = calculateRequiredJudgment(proposalType, proposalAmount);
    displayReverseResults(results);
});

function calculateRequiredJudgment(proposalType, proposalAmount) {
    let requiredJudgment, description;

    if (proposalType === 'plaintiff') {
        // Plaintiff: Judgment must be at least 25% MORE than proposal
        requiredJudgment = proposalAmount * 1.25;
        description = `For a plaintiff's proposal of ${formatCurrency(proposalAmount)}, the final judgment must be at least ${formatCurrency(requiredJudgment)} (25% more) for the proposal to be effective.`;

        return {
            type: 'Plaintiff',
            proposalAmount: proposalAmount,
            requiredJudgment: requiredJudgment,
            threshold: '25% more than proposal',
            description: description,
            range: `Any judgment of ${formatCurrency(requiredJudgment)} or higher will meet the threshold.`
        };

    } else { // defendant
        // Defendant: Judgment must be at least 25% LESS than proposal
        requiredJudgment = proposalAmount * 0.75;
        description = `For a defendant's proposal of ${formatCurrency(proposalAmount)}, the final judgment must be ${formatCurrency(requiredJudgment)} or less (25% less) for the proposal to be effective.`;

        return {
            type: 'Defendant',
            proposalAmount: proposalAmount,
            requiredJudgment: requiredJudgment,
            threshold: '25% less than proposal',
            description: description,
            range: `Any judgment of ${formatCurrency(requiredJudgment)} or lower will meet the threshold.`
        };
    }
}

function displayReverseResults(results) {
    const resultsDiv = document.getElementById('reverseResults');
    resultsDiv.textContent = '';

    const direction = results.type === 'Plaintiff' ? 'at least' : 'no more than';

    var h3 = document.createElement('h3');
    h3.textContent = 'Required Judgment Amount';
    resultsDiv.appendChild(h3);

    var proposalP = document.createElement('p');
    var proposalStrong = document.createElement('strong');
    proposalStrong.textContent = results.type + "'s Proposal:";
    proposalP.appendChild(proposalStrong);
    proposalP.appendChild(document.createTextNode(' ' + formatCurrency(results.proposalAmount)));
    resultsDiv.appendChild(proposalP);

    var thresholdP = document.createElement('p');
    var thresholdStrong = document.createElement('strong');
    thresholdStrong.textContent = 'Required Threshold:';
    thresholdP.appendChild(thresholdStrong);
    thresholdP.appendChild(document.createTextNode(' ' + results.threshold));
    resultsDiv.appendChild(thresholdP);

    var highlightDiv = document.createElement('div');
    highlightDiv.className = 'result-highlight';
    var highlightP = document.createElement('p');
    highlightP.textContent = 'Judgment must be ' + direction + ': ' + formatCurrency(results.requiredJudgment);
    highlightDiv.appendChild(highlightP);
    resultsDiv.appendChild(highlightDiv);

    var descP = document.createElement('p');
    descP.textContent = results.description;
    resultsDiv.appendChild(descP);

    var noteP = document.createElement('p');
    noteP.className = 'result-note';
    var noteStrong = document.createElement('strong');
    noteStrong.textContent = 'Note:';
    noteP.appendChild(noteStrong);
    noteP.appendChild(document.createTextNode(' ' + results.range));
    resultsDiv.appendChild(noteP);

    resultsDiv.className = 'results success';
}

// Format currency inputs when user leaves the field
function formatCurrencyInput(input) {
    let value = input.value.replace(/[^0-9.]/g, '');
    if (value) {
        const number = parseFloat(value);
        input.value = '$' + number.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }
}

function parseCurrencyInput(value) {
    var cleaned = value.replace(/[^0-9.]/g, '');
    // Handle multiple decimal points - keep only first
    var parts = cleaned.split('.');
    if (parts.length > 2) {
        cleaned = parts[0] + '.' + parts.slice(1).join('');
    }
    return parseFloat(cleaned) || 0;
}

// Apply to all amount inputs - format on blur, remove formatting on focus
['proposalAmount', 'judgmentAmount', 'reverseProposalAmount', 'expectedJudgment'].forEach(function(id) {
    var el = document.getElementById(id);
    el.addEventListener('blur', function(e) { formatCurrencyInput(e.target); });
    el.addEventListener('focus', function(e) { e.target.value = e.target.value.replace(/[^0-9.]/g, ''); });
});

// Strategic Calculator
document.getElementById('strategicForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const proposalTypeElement = document.querySelector('input[name="strategicProposalType"]:checked');
    if (!proposalTypeElement) {
        const errorDiv = document.getElementById('strategicError');
        errorDiv.textContent = 'Please select who will make the proposal.';
        errorDiv.style.display = 'block';
        return;
    }
    const proposalType = proposalTypeElement.value;
    const expectedJudgment = parseCurrencyInput(document.getElementById('expectedJudgment').value);
    
    // Validation
    const errorDiv = document.getElementById('strategicError');
    if (expectedJudgment <= 0) {
        errorDiv.textContent = 'Please enter a valid judgment amount greater than $0.';
        errorDiv.style.display = 'block';
        return;
    }
    errorDiv.style.display = 'none';
    
    const results = calculateStrategicProposal(proposalType, expectedJudgment);
    displayStrategicResults(results);
});

function calculateStrategicProposal(proposalType, expectedJudgment) {
    let proposalAmount, description;
    const safetyMargin = 1; // $1 buffer for safety

    if (proposalType === 'plaintiff') {
        // Plaintiff: J >= P * 1.25, so P <= J / 1.25
        // Round DOWN and subtract $1 for safety
        proposalAmount = Math.floor(expectedJudgment / 1.25) - safetyMargin;
        description = `To make a judgment of ${formatCurrency(expectedJudgment)} meet the 25% threshold, you should propose ${formatCurrency(proposalAmount)} or less.`;

        return {
            type: 'Plaintiff',
            expectedJudgment: expectedJudgment,
            proposalAmount: proposalAmount,
            description: description,
            range: `Any proposal of ${formatCurrency(proposalAmount)} or lower will meet the threshold if the judgment is ${formatCurrency(expectedJudgment)}.`
        };

    } else { // defendant
        // Defendant: J <= P * 0.75, so P >= J / 0.75
        // Round UP and add $1 for safety
        proposalAmount = Math.ceil(expectedJudgment / 0.75) + safetyMargin;
        description = `To make a judgment of ${formatCurrency(expectedJudgment)} meet the 25% threshold, you should propose ${formatCurrency(proposalAmount)} or more.`;

        return {
            type: 'Defendant',
            expectedJudgment: expectedJudgment,
            proposalAmount: proposalAmount,
            description: description,
            range: `Any proposal of ${formatCurrency(proposalAmount)} or higher will meet the threshold if the judgment is ${formatCurrency(expectedJudgment)}.`
        };
    }
}

function displayStrategicResults(results) {
    const resultsDiv = document.getElementById('strategicResults');
    resultsDiv.textContent = '';

    const direction = results.type === 'Plaintiff' ? 'at most' : 'at least';

    var h3 = document.createElement('h3');
    h3.textContent = 'Recommended Proposal Amount';
    resultsDiv.appendChild(h3);

    var judgmentP = document.createElement('p');
    var judgmentStrong = document.createElement('strong');
    judgmentStrong.textContent = 'Expected Judgment:';
    judgmentP.appendChild(judgmentStrong);
    judgmentP.appendChild(document.createTextNode(' ' + formatCurrency(results.expectedJudgment)));
    resultsDiv.appendChild(judgmentP);

    var highlightDiv = document.createElement('div');
    highlightDiv.className = 'result-highlight';
    var highlightP = document.createElement('p');
    highlightP.textContent = 'Propose ' + direction + ': ' + formatCurrency(results.proposalAmount);
    highlightDiv.appendChild(highlightP);
    resultsDiv.appendChild(highlightDiv);

    var descP = document.createElement('p');
    descP.textContent = results.description;
    resultsDiv.appendChild(descP);

    var noteP = document.createElement('p');
    noteP.className = 'result-note';
    var noteStrong = document.createElement('strong');
    noteStrong.textContent = 'Note:';
    noteP.appendChild(noteStrong);
    noteP.appendChild(document.createTextNode(' ' + results.range));
    resultsDiv.appendChild(noteP);

    var safetyP = document.createElement('p');
    safetyP.className = 'result-safety-note';
    var safetyStrong = document.createElement('strong');
    safetyStrong.textContent = 'Safety Buffer:';
    safetyP.appendChild(safetyStrong);
    safetyP.appendChild(document.createTextNode(' This calculation includes a $1 safety buffer to account for rounding. The actual threshold calculation may vary based on how the court rounds. Always verify with counsel and review relevant case law.'));
    resultsDiv.appendChild(safetyP);

    resultsDiv.className = 'results success';
}
