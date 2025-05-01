Allow multi steps mechanism until it satisfy the prompt
    after await aiConnector.generatePlan(command, pageData);
    check if current page satisfy the command AIVerification.check(command,currentPage)
        if not, then call  aiConnector.generatePlan(command, currentPage);
        else then stop
    
    