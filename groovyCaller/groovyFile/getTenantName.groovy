import groovy.json.JsonOutput;

def tenant = ctx.getTenant()
def tenantName = tenant ? tenant.getName() : null

return JsonOutput.toJson([
  tenantName: tenantName
])